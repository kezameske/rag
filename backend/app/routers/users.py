"""User management endpoints (admin only)."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_admin_user, User
from app.db.supabase import get_supabase_client

router = APIRouter(prefix="/users", tags=["users"])


class UserUpdate(BaseModel):
    is_approved: bool | None = None
    is_admin: bool | None = None


@router.get("")
async def list_users(current_user: User = Depends(get_admin_user)):
    """List all users with their profile info."""
    supabase = get_supabase_client()

    # Get all user profiles
    profiles = supabase.table("user_profiles").select("*").execute()
    profile_map = {p["user_id"]: p for p in (profiles.data or [])}

    # Get all users from auth.users via admin API
    auth_users = supabase.auth.admin.list_users()

    users = []
    for u in auth_users:
        profile = profile_map.get(u.id, {})
        users.append({
            "id": u.id,
            "email": u.email,
            "created_at": u.created_at,
            "is_admin": profile.get("is_admin", False),
            "is_approved": profile.get("is_approved", False),
        })

    # Sort by created_at descending
    users.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return users


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    data: UserUpdate,
    current_user: User = Depends(get_admin_user),
):
    """Update a user's approval or admin status."""
    # Prevent self-demotion
    if user_id == current_user.id:
        if data.is_admin is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove your own admin status"
            )
        if data.is_approved is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot revoke your own approval"
            )

    supabase = get_supabase_client()

    update_data = {}
    if data.is_approved is not None:
        update_data["is_approved"] = data.is_approved
    if data.is_admin is not None:
        update_data["is_admin"] = data.is_admin

    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )

    result = supabase.table("user_profiles").update(update_data).eq(
        "user_id", user_id
    ).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return result.data[0]


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_user: User = Depends(get_admin_user),
):
    """Delete a user entirely."""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself"
        )

    supabase = get_supabase_client()

    # Delete from auth (cascades to user_profiles via trigger/FK)
    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete user: {str(e)}"
        )
